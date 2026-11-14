// HUTA — fizyczna ruda: SYMULACJA W WĄTKU ROBOCZYM (Web Worker modułowy) i format migawki dla obrazu.
//
// Ten sam kod gospodarza symulacji działa w dwóch miejscach:
//   • w workerze (`new Worker(new URL('./ruda.worker.js', import.meta.url), { type: 'module' })`) — plik sam podpina
//     `onmessage`, gdy wykryje zakres workera;
//   • na wątku strony (`createRudaHost(post)`, awaryjnie: ?worker=0) — te same wiadomości, bez kopiowania.
//
// MIGAWKA to jeden ArrayBuffer o stałym układzie (`snapLayout`): stan maszyn i liczniki (Float64), rekordy ruchomych
// ziaren 12 × f32 (ciała ładowni | ciała zasieku | rura w oknach | taśma), zdarzenia pyłu 5 × f32, zmienione kolumny
// obu krat (indeksy Int32 + rekordy 8 × u32). `station.snapshot()` pisze WPROST do widoków tego bufora; bufor idzie
// do strony przez przekazanie własności (bez kopii) i wraca wiadomością `recycle` — pula 4 buforów jest też hamulcem:
// gdy strona nie odbiera (karta w tle), worker nie ma bufora i nie kroczy.
//
// Wiadomości do gospodarza:
//   { type: 'init', gen, ore, seed, sun: [x, y, z], speed, live }   nowe stanowisko (rozbieg ~1 s), potem migawka t = 0
//   { type: 'speed', value }   tempo (0 = pauza);   { type: 'live', on }   kroki w czasie rzeczywistym
//   { type: 'advance', id, seconds, tail }   kroki „ile fabryka dała” (zrzuty): migawki tylko z ostatnich `tail` kroków
//   { type: 'recycle', buf }   zwrot bufora migawki
// Wiadomości od gospodarza:
//   { type: 'ready', gen, layout, ore, initMs }   { type: 'snap', gen, buf }   { type: 'advanced', id, steps, ms }
//
// Krok na żywo: co 1/60 s czasu ściany `station.step(tempo / 60)` (tempo ≥ 1) albo co (1/60) / tempo s krok 1/60 s
// (zwolnienie) — rekord ziarna niesie pozycję z początku i z końca TEGO kroku, obraz interpoluje między nimi.
import { COUNTER, STATE, createOreStation } from './stanowisko.js';

/**
 * Układ nagłówka migawki (indeksy Float64): stan 0…31 (STATE), liczniki 32…47 (COUNTER), dodatki od 48.
 * JEDEN WORKER = JEDNO STANOWISKO: strona przy zmianie rudy kończy worker i tworzy nowy. Drugie stanowisko w tym samym
 * izolacie V8 alokuje w kroku (ok. 70 B na krok — domknięcia przestają być „jedyne”), pierwsze nie alokuje wcale.
 */
export const SNAP = Object.freeze({
  state: 0, counters: 32, extra: 48, headWords: 64,
  // dodatki (indeksy w `extra`)
  nHold: 0, nBunker: 1, nPipe: 2, nBelt: 3, nEvents: 4, holdAll: 5, holdCount: 6, bunkerAll: 7, bunkerCount: 8,
  stepSim: 9, stepMs: 10, snapMs: 11, seq: 12, gen: 13, speed: 14, bodiesPeak: 15
});

/** Układ bufora migawki z pojemności stanowiska (bajty; każda sekcja wyrównana do 8). */
export function snapLayout(probe) {
  const L = { head: 0 };
  let o = SNAP.headWords * 8;
  const put = (name, bytes) => { L[name] = o; o += (bytes + 7) & ~7; };
  L.movingLen = probe.moving.length;
  L.eventsLen = probe.events.length;
  L.holdN = probe.hold.cols.length;
  L.bunkerN = probe.bunker.cols.length;
  put('moving', L.movingLen * 4);
  put('events', L.eventsLen * 4);
  put('holdCols', L.holdN * 4);
  put('holdRec', probe.hold.rec.length * 4);
  put('bunkerCols', L.bunkerN * 4);
  put('bunkerRec', probe.bunker.rec.length * 4);
  L.holdRecLen = probe.hold.rec.length;
  L.bunkerRecLen = probe.bunker.rec.length;
  L.bytes = o;
  return L;
}

/** Widoki migawki na buforze (ten sam kształt co `station.createSnapshot()` + `extra`). */
export function snapViews(buf, L) {
  return {
    buf,
    state: new Float64Array(buf, SNAP.state * 8, 32),
    counters: new Float64Array(buf, SNAP.counters * 8, 16),
    extra: new Float64Array(buf, SNAP.extra * 8, 16),
    moving: new Float32Array(buf, L.moving, L.movingLen),
    nHold: 0, nBunker: 0, nPipe: 0, nBelt: 0,
    events: new Float32Array(buf, L.events, L.eventsLen), nEvents: 0,
    // `recF` — te same bajty rekordów jako f32 (słowo 7 rekordu to wysokość ziarna)
    hold: { all: false, count: 0, cols: new Int32Array(buf, L.holdCols, L.holdN), rec: new Uint32Array(buf, L.holdRec, L.holdRecLen), recF: new Float32Array(buf, L.holdRec, L.holdRecLen) },
    bunker: { all: false, count: 0, cols: new Int32Array(buf, L.bunkerCols, L.bunkerN), rec: new Uint32Array(buf, L.bunkerRec, L.bunkerRecLen), recF: new Float32Array(buf, L.bunkerRec, L.bunkerRecLen) }
  };
}

const POOL = 4;
const now = () => performance.now();

/**
 * Gospodarz symulacji: `post(wiadomość, przekazywane)` wysyła do strony; zwraca `{ handle(wiadomość) }`.
 */
export function createRudaHost(post) {
  let st = null;
  let layout = null;
  let gen = 0;
  let seq = 0;
  let speed = 1;
  let live = false;
  let busy = false;                 // trwa `advance`
  let nextDue = 0;
  let timer = null;
  const pool = [];
  const waiters = [];
  const scratch = new Float32Array(256 * 5);

  function emit(stepSim, stepMs) {
    const buf = pool.pop();
    const snap = snapViews(buf, layout);
    const t0 = now();
    st.snapshot(snap, true);
    const x = snap.extra;
    x[SNAP.nHold] = snap.nHold; x[SNAP.nBunker] = snap.nBunker; x[SNAP.nPipe] = snap.nPipe; x[SNAP.nBelt] = snap.nBelt;
    x[SNAP.nEvents] = snap.nEvents;
    x[SNAP.holdAll] = snap.hold.all ? 1 : 0; x[SNAP.holdCount] = snap.hold.count;
    x[SNAP.bunkerAll] = snap.bunker.all ? 1 : 0; x[SNAP.bunkerCount] = snap.bunker.count;
    x[SNAP.stepSim] = stepSim; x[SNAP.stepMs] = stepMs; x[SNAP.snapMs] = now() - t0;
    x[SNAP.seq] = seq++; x[SNAP.gen] = gen; x[SNAP.speed] = speed;
    x[SNAP.bodiesPeak] = st.bodies.bunker.peak;
    post({ type: 'snap', gen, buf }, [buf]);
  }

  function stepOnce(simDt) {
    const t0 = now();
    st.step(simDt);
    return now() - t0;
  }

  function tick() {
    timer = null;
    if (st && live && !busy && speed > 0) {
      const t = now();
      const stepSim = speed >= 1 ? speed / 60 : 1 / 60;
      const stepReal = (stepSim / speed) * 1000;
      let guard = 0;
      while (t >= nextDue && pool.length > 0 && guard < 2) {
        emit(stepSim, stepOnce(stepSim));
        nextDue += stepReal;
        guard++;
      }
      if (t - nextDue > 120) nextDue = t;          // zaległość (karta w tle, brak buforów) przepada
    }
    schedule();
  }
  function schedule() {
    if (timer === null && st && live) timer = setTimeout(tick, 2);
  }

  function init(m) {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    const t0 = now();
    st = createOreStation({ ore: m.ore | 0, seed: m.seed === undefined ? 7 : m.seed });
    if (m.sun) st.setSun(m.sun[0], m.sun[1], m.sun[2]);
    if (!layout) {
      layout = snapLayout(st.createSnapshot());
      for (let i = 0; i < POOL; i++) pool.push(new ArrayBuffer(layout.bytes));
    }
    gen = m.gen | 0;
    seq = 0;
    speed = m.speed === undefined ? 1 : +m.speed;
    live = !!m.live;
    busy = false;
    post({ type: 'ready', gen, layout, ore: st.ore.index, initMs: now() - t0 });
    waitBuffer().then(() => { if ((m.gen | 0) === gen) { emit(0, 0); nextDue = now(); schedule(); } });
  }

  function waitBuffer() {
    if (pool.length > 0) return Promise.resolve();
    return new Promise((ok) => waiters.push(ok));
  }

  async function advance(m) {
    if (!st) return;
    const myGen = gen;
    busy = true;
    const steps = Math.max(0, Math.round(m.seconds * 60));
    const tail = Math.min(steps, m.tail === undefined ? 120 : m.tail | 0);
    const t0 = now();
    let sum = 0;
    let worst = 0;
    for (let i = 0; i < steps - tail; i++) {
      const ms = stepOnce(1 / 60);
      sum += ms;
      if (ms > worst) worst = ms;
      st.drainEvents(scratch);                    // pył sprzed ogona nie doczeka zrzutu
    }
    for (let i = 0; i < tail && myGen === gen; i++) {
      await waitBuffer();
      const ms = stepOnce(1 / 60);
      sum += ms;
      if (ms > worst) worst = ms;
      emit(1 / 60, ms);
    }
    if (steps === 0 && myGen === gen) { await waitBuffer(); emit(0, 0); }
    busy = false;
    nextDue = now();
    post({ type: 'advanced', id: m.id, gen: myGen, steps, ms: now() - t0, stepMs: steps ? sum / steps : 0, stepMax: worst });
  }

  function handle(m) {
    switch (m.type) {
      case 'init': init(m); break;
      case 'speed': speed = +m.value || 0; nextDue = now(); break;
      case 'live': live = !!m.on; nextDue = now(); schedule(); break;
      case 'advance': advance(m); break;
      case 'recycle':
        if (m.buf && m.buf.byteLength === (layout ? layout.bytes : -1)) pool.push(m.buf);
        if (waiters.length && pool.length) waiters.shift()();
        break;
      default: break;
    }
  }
  return { handle };
}

export { COUNTER, STATE };

// ---- zakres workera: podpięcie wiadomości
const scope = typeof self !== 'undefined' ? self : null;
if (scope && typeof scope.WorkerGlobalScope !== 'undefined' && scope instanceof scope.WorkerGlobalScope) {
  const host = createRudaHost((msg, transfer) => scope.postMessage(msg, transfer || []));
  scope.onmessage = (e) => {
    try { host.handle(e.data); } catch (err) { scope.postMessage({ type: 'error', text: String(err && err.stack ? err.stack : err) }); }
  };
}
