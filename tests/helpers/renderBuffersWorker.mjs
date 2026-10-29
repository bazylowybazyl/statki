// Wątki testu tests/renderBuffers.test.mjs (RW-04): pisarz i czytelnik potrójnego bufora, pierścienia rozkazów
// i kanału zwrotnego na SharedArrayBuffer. Rola w workerData.role.
//
// Koniec pracy wyznacza PRACA, nie okno czasu ściany: na obciążonej maszynie (równoległe sesje, harnessy) worker
// wstaje z opóźnieniem i bywa wywłaszczany, więc „900 ms” nie mówiło, ile przeplotu się wydarzyło (czytelnik
// startujący 50 ms przed pisarzem kończył przed jego ostatnią stroną). Obie strony ruszają razem (`startTogether`),
// pisarz robi swoją liczbę klatek i czeka na porcję czytelnika, czytelnik kończy na znak pisarza (`sync`).
import { parentPort, workerData, receiveMessageOnPort } from 'node:worker_threads';
import { TripleBufferWriter, TripleBufferReader } from '../../src/render/tripleBuffer.js';
import { EventRingWriter, EventRingReader } from '../../src/render/eventRing.js';
import { createReturnViews, retWriteBreach, retReadBreach, RET_BREACH } from '../../src/render/returnLayout.js';

const sleepCell = new Int32Array(new SharedArrayBuffer(4));
function sleep(ms) {
  if (ms > 0) Atomics.wait(sleepCell, 0, 0, ms);
}
const now = () => performance.now();

// Komórki `workerData.sync` (Int32Array na SharedArrayBuffer, wspólna dla pary wątków).
const SYNC = { START: 0, DONE: 1, PROGRESS: 2 };
function startTogether(sync) {
  Atomics.add(sync, SYNC.START, 1);
  Atomics.notify(sync, SYNC.START);
  for (let v; (v = Atomics.load(sync, SYNC.START)) < 2;) Atomics.wait(sync, SYNC.START, v, 50);
}
const writerDone = (sync) => Atomics.load(sync, SYNC.DONE) === 1;

// Deterministyczne losowanie (mulberry32) — przebiegi powtarzalne co do ciągu decyzji.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Wartość słowa i strony k — strona rozdarta = słowa z różnych k.
const pageWord = (k, i) => k * 8192 + (i * 2654435761 % 8191);

// Pisarz: `durationMs · hz` stron w tempie hz (zaległość po wywłaszczeniu nadrabia bez snu), potem dalej, aż
// czytelnik odbierze `minAcquired` stron (sufit — 20 × tyle stron: czytelnik, który nic nie odbiera, kończy test).
function tripleWriter({ buffer, pageBytes, durationMs, hz, sync, minAcquired }) {
  const w = new TripleBufferWriter(buffer, { pageBytes });
  const n = pageBytes >> 3;
  const period = 1000 / hz;
  const frames = Math.round(durationMs * hz / 1000);
  startTogether(sync);
  const t0 = now();
  let k = 0;
  let next = t0;
  while (k < frames || (Atomics.load(sync, SYNC.PROGRESS) < minAcquired && k < frames * 20)) {
    k++;
    const page = w.page;
    page[0] = k;
    let sum = 0;
    for (let i = 2; i < n; i++) {
      const x = pageWord(k, i);
      page[i] = x;
      sum += x;
    }
    page[1] = sum;
    w.publish();
    next += period;
    sleep(Math.max(0, next - now()));
  }
  Atomics.store(sync, SYNC.DONE, 1);
  return { published: k, overwritten: w.overwritten };
}

// Czytelnik: do znaku końca pisarza; po nim jeszcze jeden odbiór — ostatnia publikacja.
function tripleReader({ buffer, pageBytes, seed, sync }) {
  const r = new TripleBufferReader(buffer, { pageBytes });
  const rnd = rng(seed);
  const n = pageBytes >> 3;
  startTogether(sync);
  let torn = 0, sumBad = 0, backwards = 0, acquired = 0, lastK = 0, gaps = 0;
  for (;;) {
    const done = writerDone(sync);
    if (r.acquire()) {
      acquired++;
      Atomics.store(sync, SYNC.PROGRESS, acquired);
      const page = r.page;
      const k = page[0];
      if (k <= lastK) backwards++;
      if (k > lastK + 1) gaps++;
      lastK = k;
      // Wolny, nieregularny odczyt: przerwy w połowie strony (pisarz publikuje w tym czasie kilka stron).
      let sum = 0;
      const half = n >> 1;
      for (let i = 2; i < half; i++) {
        const x = page[i];
        if (x !== pageWord(k, i)) torn++;
        sum += x;
      }
      sleep(rnd() < 0.5 ? 1 + Math.floor(rnd() * 6) : 0);
      for (let i = half; i < n; i++) {
        const x = page[i];
        if (x !== pageWord(k, i)) torn++;
        sum += x;
      }
      if (sum !== page[1]) sumBad++;
      if (page[0] !== k) torn++;
    }
    if (done) break;
    sleep(Math.floor(rnd() * 12));
  }
  return { torn, sumBad, backwards, acquired, lastK, gaps, consumed: r.consumed };
}

// Rekord pierścienia: typ i długość z ciągu `seq`, ładunek z (seq, i). Co jakiś czas duży rekord — wymusza wzrost.
function recordShape(seq) {
  const h = Math.imul(seq + 1, 2654435761) >>> 0;
  const type = 1 + (h % 900);
  const big = (h >>> 10) % 97 === 0;
  const words = big ? 1500 + (h % 1800) : (h >>> 3) % 40;
  return { type, words };
}
const payloadWord = (seq, i) => seq * 4096 + i + 0.25;

// Pisarz: `durationMs · hz` klatek w tempie hz (zaległość nadrabia bez snu).
function ringWriter({ buffer, durationMs, hz, port, seed, sync }) {
  const rnd = rng(seed);
  const w = new EventRingWriter(buffer, { onGrow: (next) => port.postMessage(next) });
  const period = 1000 / hz;
  const frames = Math.round(durationMs * hz / 1000);
  startTogether(sync);
  const t0 = now();
  let frame = 0, seq = 0, next = t0;
  while (frame < frames) {
    frame++;
    // Klatka: 0–60 rekordów (szczyt bitwy ~70–170 rekordów — tu pojemność startowa mała, więc pierścień rośnie).
    const count = Math.floor(rnd() * 61);
    for (let c = 0; c < count; c++) {
      const { type, words } = recordShape(seq);
      const o = w.begin(type, frame, words);
      const d = w.data;
      d[o] = seq;
      for (let i = 1; i < words; i++) d[o + i] = payloadWord(seq, i);
      w.commit();
      seq++;
    }
    Atomics.store(workerData.frameCell, 0, frame);
    next += period;
    sleep(Math.max(0, next - now()));
  }
  Atomics.store(workerData.frameCell, 2, seq);
  Atomics.store(workerData.frameCell, 1, 1); // koniec
  return { frames: frame, records: seq, grows: w.grows, capacity: w.capacity };
}

// Czytelnik: pierwsza partia dopiero po `lagFrames` klatkach pisarza — mały pierścień rośnie kilka razy w locie
// niezależnie od tego, ile czasu system dał któremu wątkowi; dalej wolny i nieregularny, do znaku końca pisarza.
function ringReader({ buffer, port, seed, sync, lagFrames }) {
  const rnd = rng(seed);
  const r = new EventRingReader(buffer);
  let expect = 0, lastFrame = 0, bad = 0, order = 0, overFrame = 0, maxLag = 0, batches = 0, doneAt = 0;
  startTogether(sync);
  while (Atomics.load(workerData.frameCell, 0) < lagFrames && Atomics.load(workerData.frameCell, 1) !== 1) sleep(1);
  for (;;) {
    for (let m; (m = receiveMessageOnPort(port));) r.adopt(m.message);
    const done = Atomics.load(workerData.frameCell, 1) === 1;
    const writerFrame = Atomics.load(workerData.frameCell, 0);
    // Render migawki k: odtwarza rekordy klatek ≤ k; k bywa sporo za pisarzem (wolny czytelnik).
    const k = done ? Infinity : writerFrame - Math.floor(rnd() * 4);
    batches++;
    for (let o; (o = r.next(k)) >= 0;) {
      const d = r.data;
      const words = r.words;
      const { type, words: wantWords } = recordShape(expect);
      if (r.frame > k) overFrame++;
      if (r.frame < lastFrame) order++;
      lastFrame = r.frame;
      if (r.type !== type || words !== wantWords) bad++;
      else if (words > 0) {
        if (d[o] !== expect) bad++;
        for (let i = 1; i < words; i++) if (d[o + i] !== payloadWord(expect, i)) { bad++; break; }
      }
      expect++;
      if (rnd() < 0.002) sleep(3); // wolny czytelnik w środku partii
    }
    if (done) {
      if (expect >= Atomics.load(workerData.frameCell, 2)) break;
      if (now() - (doneAt ||= now()) > 3000) break; // zgubione rekordy — test pokaże różnicę liczb
      sleep(1);
      continue;
    }
    const lag = writerFrame - lastFrame;
    if (lag > maxLag) maxLag = lag;
    sleep(Math.floor(rnd() * 15));
  }
  return { records: expect, bad, order, overFrame, switches: r.switches, maxLag, batches };
}

// Pisarz: co najmniej `durationMs` i `minEpochs` epok, potem dalej, aż czytelnik zrobi `minReads` udanych odczytów
// w trakcie zapisów (sufit epok: czytelnik, który nic nie odczytuje, kończy test).
function breachWriter({ buffer, layout, durationMs, sync, minEpochs, minReads }) {
  const v = createReturnViews(buffer, layout);
  const bits = new Uint32Array(layout.breachWords);
  startTogether(sync);
  const t0 = now();
  let epoch = 0;
  while (epoch < minEpochs || now() - t0 < durationMs || (Atomics.load(sync, SYNC.PROGRESS) < minReads && epoch < 1e7)) {
    epoch++;
    for (let s = 0; s < layout.breachSlots; s++) {
      bits.fill((epoch * 31 + s) >>> 0);
      retWriteBreach(v, s, s * 3, epoch, 7 + s, epoch, bits);
    }
  }
  Atomics.store(sync, SYNC.DONE, 1);
  return { epochs: epoch };
}

function breachReader({ buffer, layout, sync }) {
  const v = createReturnViews(buffer, layout);
  const head = new Int32Array(RET_BREACH.HEADER_WORDS);
  const bits = new Uint32Array(layout.breachWords);
  startTogether(sync);
  let reads = 0, busy = 0, torn = 0;
  while (!writerDone(sync)) {
    for (let s = 0; s < layout.breachSlots; s++) {
      if (!retReadBreach(v, s, head, bits)) { busy++; continue; }
      reads++;
      Atomics.store(sync, SYNC.PROGRESS, reads);
      const epoch = head[RET_BREACH.EPOCH];
      if (epoch === 0) continue;
      const want = (epoch * 31 + s) >>> 0;
      if (head[RET_BREACH.ENT_GEN] !== epoch || head[RET_BREACH.PROFILE] !== 7 + s) torn++;
      for (let i = 0; i < bits.length; i++) if (bits[i] !== want) { torn++; break; }
    }
  }
  return { reads, busy, torn };
}

const roles = { tripleWriter, tripleReader, ringWriter, ringReader, breachWriter, breachReader };
const result = roles[workerData.role](workerData);
parentPort.postMessage(result);
